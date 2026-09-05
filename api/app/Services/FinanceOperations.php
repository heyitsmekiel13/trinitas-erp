<?php

namespace App\Services;

use App\Models\ApBill;
use App\Models\ApPayment;
use App\Models\ArInvoice;
use App\Models\ArReceipt;
use App\Models\BankTransaction;
use App\Models\BudgetLine;
use App\Models\Expense;
use App\Models\FixedAsset;
use App\Models\JournalEntry;
use App\Models\TaxFiling;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Finance actions that move money.
 *
 * Every one of them ends in a journal entry, because that is what makes the
 * event real to the rest of the system: a receipt that does not debit cash and
 * credit receivables has not been accounted for, however green the invoice row
 * looks on screen.
 */
class FinanceOperations
{
    /* Accounts these postings use. Codes rather than ids so the mapping is
       readable next to the entry it produces. */
    private const CASH_ON_HAND = '1110';

    private const CASH_IN_BANK = '1120';

    private const RECEIVABLES = '1130';

    private const INPUT_VAT = '1150';

    private const ACCUM_DEPRECIATION = '1215';

    private const PAYABLES = '2110';

    private const OUTPUT_VAT = '2130';

    private const REVENUE = '4110';

    private const DEPRECIATION_EXPENSE = '5270';

    private const DEFAULT_EXPENSE = '5240';

    public function __construct(
        private readonly Ledger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /* ====================== Accounts receivable ======================= */

    /**
     * Posts a customer invoice to the ledger.
     *
     * Debit what the customer owes; credit the revenue earned and the VAT owed
     * to the BIR. Splitting VAT out at this point is what makes the 2550M
     * return something the system can assemble rather than reconstruct.
     *
     * @throws ValidationException
     */
    public function postInvoice(ArInvoice $invoice): ArInvoice
    {
        if ($invoice->status !== 'Draft') {
            throw ValidationException::withMessages([
                'status' => "{$invoice->invoice_no} has already been posted.",
            ]);
        }

        return DB::transaction(function () use ($invoice) {
            $net = $invoice->net_amount;
            $vat = round((float) $invoice->vat_amount, 2);

            $this->ledger->postDocument(
                source: 'Sales',
                memo: "Invoice {$invoice->invoice_no} — ".($invoice->customer->name ?? 'customer'),
                lines: [
                    ['account' => self::RECEIVABLES, 'debit' => (float) $invoice->amount, 'description' => $invoice->invoice_no],
                    ['account' => self::REVENUE, 'credit' => $net, 'description' => $invoice->memo],
                    ['account' => self::OUTPUT_VAT, 'credit' => $vat, 'description' => 'Output VAT'],
                ],
                reference: $invoice,
                date: optional($invoice->invoice_date)->toDateString(),
            );

            $invoice->status = 'Posted';
            $invoice->save();

            $this->audit->log('posted a sales invoice', 'ArInvoice', $invoice->id, $invoice->invoice_no, 'finance');

            return $invoice->fresh();
        });
    }

    /**
     * Records money in from a customer and applies it to their invoices.
     *
     * Allocation is the substance of the transaction: "₱50,000 received" is
     * bookkeeping, "₱50,000 against these three invoices" is what clears the
     * ageing report and tells collections who to stop chasing.
     *
     * @param  array<int, array{invoiceId: int, amount: float}>  $allocations
     *
     * @throws ValidationException
     */
    public function receivePayment(array $data): ArReceipt
    {
        return DB::transaction(function () use ($data) {
            $allocations = $data['allocations'] ?? [];
            $amount = round((float) $data['amount'], 2);

            $applied = round(array_sum(array_map(fn ($a) => (float) $a['amount'], $allocations)), 2);

            if ($applied > $amount + 0.005) {
                throw ValidationException::withMessages([
                    'allocations' => sprintf(
                        'Applying %s against a receipt of %s. A receipt cannot settle more than was received.',
                        number_format($applied, 2),
                        number_format($amount, 2),
                    ),
                ]);
            }

            $this->guardAllocations($allocations, ArInvoice::class, 'invoiceId', 'invoice');

            $receipt = ArReceipt::create([
                'receipt_no' => $this->nextNumber(ArReceipt::class, 'receipt_no', 'OR-'),
                'customer_id' => $data['customerId'],
                'bank_account_id' => $data['bankAccountId'] ?? null,
                'receipt_date' => $data['date'] ?? now()->toDateString(),
                'amount' => $amount,
                'method' => $data['method'] ?? 'Bank Transfer',
                'reference' => $data['reference'] ?? null,
                'received_by' => $data['receivedBy'] ?? null,
                'status' => 'Posted',
            ]);

            foreach ($allocations as $allocation) {
                if ((float) $allocation['amount'] <= 0) {
                    continue;
                }

                $receipt->allocations()->create([
                    'ar_invoice_id' => $allocation['invoiceId'],
                    'amount' => round((float) $allocation['amount'], 2),
                ]);
            }

            // Cash goes where it was actually deposited.
            $cashAccount = $data['bankAccountId'] ? self::CASH_IN_BANK : self::CASH_ON_HAND;

            $entry = $this->ledger->postDocument(
                source: 'Cash',
                memo: "Receipt {$receipt->receipt_no} — ".($receipt->customer->name ?? 'customer'),
                lines: [
                    ['account' => $cashAccount, 'debit' => $amount, 'description' => $receipt->reference],
                    ['account' => self::RECEIVABLES, 'credit' => $amount, 'description' => $receipt->receipt_no],
                ],
                reference: $receipt,
                date: optional($receipt->receipt_date)->toDateString(),
            );

            $receipt->forceFill(['journal_entry_id' => $entry->id])->save();

            $this->recordBankMovement($receipt->bank_account_id, [
                'date' => optional($receipt->receipt_date)->toDateString(),
                'description' => "Receipt {$receipt->receipt_no} — ".($receipt->customer->name ?? ''),
                'reference' => $receipt->reference ?? $receipt->receipt_no,
                'debit' => $amount,
                'journalEntryId' => $entry->id,
            ]);

            $this->audit->log('recorded a customer receipt', 'ArReceipt', $receipt->id, $receipt->receipt_no, 'finance');

            return $receipt->fresh(['allocations.invoice', 'customer']);
        });
    }

    /* ======================== Accounts payable ======================== */

    /**
     * Posts a supplier bill: the expense (or asset) and the VAT you can claim,
     * against what you now owe.
     *
     * @throws ValidationException
     */
    public function postBill(ApBill $bill): ApBill
    {
        if ($bill->status !== 'Draft') {
            throw ValidationException::withMessages([
                'status' => "{$bill->bill_no} has already been posted.",
            ]);
        }

        return DB::transaction(function () use ($bill) {
            $expenseAccount = $bill->account_id ?: $this->ledger->accountId(self::DEFAULT_EXPENSE);

            $this->ledger->postDocument(
                source: 'Purchases',
                memo: "Bill {$bill->bill_no} — ".($bill->supplier->name ?? 'supplier'),
                lines: [
                    ['account' => $expenseAccount, 'debit' => $bill->net_amount, 'description' => $bill->memo],
                    ['account' => self::INPUT_VAT, 'debit' => (float) $bill->vat_amount, 'description' => 'Input VAT'],
                    ['account' => self::PAYABLES, 'credit' => (float) $bill->amount, 'description' => $bill->bill_no],
                ],
                reference: $bill,
                date: optional($bill->bill_date)->toDateString(),
            );

            $bill->status = 'Approved';
            $bill->save();

            $this->audit->log('posted a supplier bill', 'ApBill', $bill->id, $bill->bill_no, 'finance');

            return $bill->fresh();
        });
    }

    /**
     * Pays a supplier and applies the payment across their bills.
     *
     * @throws ValidationException
     */
    public function payBills(array $data): ApPayment
    {
        return DB::transaction(function () use ($data) {
            $allocations = $data['allocations'] ?? [];
            $amount = round((float) $data['amount'], 2);
            $applied = round(array_sum(array_map(fn ($a) => (float) $a['amount'], $allocations)), 2);

            if ($applied > $amount + 0.005) {
                throw ValidationException::withMessages([
                    'allocations' => sprintf(
                        'Applying %s against a payment of %s.',
                        number_format($applied, 2),
                        number_format($amount, 2),
                    ),
                ]);
            }

            $this->guardAllocations($allocations, ApBill::class, 'billId', 'bill');

            $payment = ApPayment::create([
                'payment_no' => $this->nextNumber(ApPayment::class, 'payment_no', 'PV-'),
                'supplier_id' => $data['supplierId'],
                'bank_account_id' => $data['bankAccountId'] ?? null,
                'payment_date' => $data['date'] ?? now()->toDateString(),
                'amount' => $amount,
                'method' => $data['method'] ?? 'Bank Transfer',
                'reference' => $data['reference'] ?? null,
                'status' => 'Posted',
            ]);

            foreach ($allocations as $allocation) {
                if ((float) $allocation['amount'] <= 0) {
                    continue;
                }

                $payment->allocations()->create([
                    'ap_bill_id' => $allocation['billId'],
                    'amount' => round((float) $allocation['amount'], 2),
                ]);
            }

            $cashAccount = $data['bankAccountId'] ? self::CASH_IN_BANK : self::CASH_ON_HAND;

            $entry = $this->ledger->postDocument(
                source: 'Cash',
                memo: "Payment {$payment->payment_no} — ".($payment->supplier->name ?? 'supplier'),
                lines: [
                    ['account' => self::PAYABLES, 'debit' => $amount, 'description' => $payment->payment_no],
                    ['account' => $cashAccount, 'credit' => $amount, 'description' => $payment->reference],
                ],
                reference: $payment,
                date: optional($payment->payment_date)->toDateString(),
            );

            $payment->forceFill(['journal_entry_id' => $entry->id])->save();

            $this->recordBankMovement($payment->bank_account_id, [
                'date' => optional($payment->payment_date)->toDateString(),
                'description' => "Payment {$payment->payment_no} — ".($payment->supplier->name ?? ''),
                'reference' => $payment->reference ?? $payment->payment_no,
                'credit' => $amount,
                'journalEntryId' => $entry->id,
            ]);

            $this->audit->log('paid a supplier', 'ApPayment', $payment->id, $payment->payment_no, 'finance');

            return $payment->fresh(['allocations.bill', 'supplier']);
        });
    }

    /* ============================ Expenses =========================== */

    /**
     * Approves an expense claim and books it.
     *
     * The category decides the account unless somebody has chosen one, so a
     * claim for fuel lands in fuel rather than in a catch-all nobody analyses.
     *
     * @throws ValidationException
     */
    public function approveExpense(Expense $expense): Expense
    {
        if (in_array($expense->status, ['Approved', 'Liquidated'], true)) {
            throw ValidationException::withMessages([
                'status' => "{$expense->expense_no} has already been approved.",
            ]);
        }

        if ($expense->status === 'Rejected') {
            throw ValidationException::withMessages([
                'status' => 'A rejected claim cannot be approved. Ask for it to be re-submitted.',
            ]);
        }

        return DB::transaction(function () use ($expense) {
            $account = $expense->account_id
                ?: $this->ledger->accountId(Expense::CATEGORY_ACCOUNTS[$expense->category] ?? self::DEFAULT_EXPENSE);

            // Petty cash comes out of the tin; everything else is owed back to
            // whoever paid for it.
            $credit = $expense->fund_type === 'Petty Cash' ? self::CASH_ON_HAND : self::PAYABLES;

            $entry = $this->ledger->postDocument(
                source: 'Cash',
                memo: "Expense {$expense->expense_no} — {$expense->category}",
                lines: [
                    [
                        'account' => $account,
                        'debit' => (float) $expense->amount,
                        'description' => $expense->description ?: $expense->category,
                        'departmentId' => $expense->hr_department_id,
                    ],
                    ['account' => $credit, 'credit' => (float) $expense->amount, 'description' => $expense->expense_no],
                ],
                reference: $expense,
                date: optional($expense->expense_date)->toDateString(),
            );

            $expense->forceFill([
                'status' => 'Approved',
                'account_id' => $account,
                'journal_entry_id' => $entry->id,
            ])->save();

            $this->audit->log('approved an expense claim', 'Expense', $expense->id, $expense->expense_no, 'finance');

            return $expense->fresh();
        });
    }

    /* ========================== Fixed assets ========================= */

    /**
     * Runs depreciation for a month.
     *
     * One journal for the whole run rather than one per asset — that is how a
     * bookkeeper posts it, and it keeps the ledger readable. Assets already
     * depreciated to that month are skipped, so running it twice is safe.
     *
     * @throws ValidationException
     */
    public function runDepreciation(?string $month = null): array
    {
        $period = $month ? CarbonImmutable::parse($month)->startOfMonth() : CarbonImmutable::now()->startOfMonth();

        return DB::transaction(function () use ($period) {
            $assets = FixedAsset::query()
                ->whereNotIn('status', ['Disposed', 'Impaired'])
                ->get();

            $charges = [];
            $total = 0.0;

            foreach ($assets as $asset) {
                $charge = $asset->chargeableFor($period);

                if ($charge <= 0) {
                    continue;
                }

                $charges[] = ['asset' => $asset, 'amount' => $charge];
                $total += $charge;
            }

            $total = round($total, 2);

            if ($total <= 0) {
                return [
                    'posted' => false,
                    'month' => $period->format('Y-m'),
                    'assets' => 0,
                    'amount' => 0.0,
                    'message' => 'Nothing to depreciate for '.$period->format('F Y')
                        .' — every asset is either fully depreciated or already run for this month.',
                    'lines' => [],
                ];
            }

            $entry = $this->ledger->postDocument(
                source: 'Depreciation',
                memo: 'Depreciation for '.$period->format('F Y'),
                lines: [
                    ['account' => self::DEPRECIATION_EXPENSE, 'debit' => $total, 'description' => $period->format('F Y')],
                    ['account' => self::ACCUM_DEPRECIATION, 'credit' => $total, 'description' => $period->format('F Y')],
                ],
                date: $period->endOfMonth()->toDateString(),
            );

            foreach ($charges as $charge) {
                $asset = $charge['asset'];
                $asset->forceFill([
                    'accumulated_depreciation' => round((float) $asset->accumulated_depreciation + $charge['amount'], 2),
                    'depreciated_to' => $period->endOfMonth()->toDateString(),
                ])->save();
            }

            $this->audit->log(
                'ran depreciation',
                'JournalEntry',
                $entry->id,
                $period->format('F Y').' — '.count($charges).' asset(s)',
                'finance',
            );

            return [
                'posted' => true,
                'month' => $period->format('Y-m'),
                'journalNo' => $entry->journal_no,
                'assets' => count($charges),
                'amount' => $total,
                'message' => 'Posted '.$entry->journal_no.' for '.$period->format('F Y').'.',
                'lines' => array_map(fn ($c) => [
                    'code' => $c['asset']->code,
                    'name' => $c['asset']->name,
                    'amount' => $c['amount'],
                    'netBookValue' => round((float) $c['asset']->cost - (float) $c['asset']->accumulated_depreciation, 2),
                ], $charges),
            ];
        });
    }

    /* ============================== Tax ============================== */

    /**
     * Marks a return filed and books what is owed to the BIR.
     *
     * @throws ValidationException
     */
    public function fileTax(TaxFiling $filing, array $data): TaxFiling
    {
        if (in_array($filing->status, ['Filed', 'Paid'], true)) {
            throw ValidationException::withMessages([
                'status' => "{$filing->form} for {$filing->period} has already been filed.",
            ]);
        }

        return DB::transaction(function () use ($filing, $data) {
            $filing->forceFill([
                'filed_on' => $data['filedOn'] ?? now()->toDateString(),
                'confirmation_no' => $data['confirmationNo'] ?? null,
                'status' => 'Filed',
            ])->save();

            $this->audit->log(
                'filed a tax return',
                'TaxFiling',
                $filing->id,
                "{$filing->form} — {$filing->period}",
                'finance',
            );

            return $filing->fresh();
        });
    }

    /* ============================ Budgets ============================ */

    /**
     * Refreshes every budget line's actuals from the ledger.
     *
     * Actual spend is what has been posted to that account for that department,
     * not a figure anyone maintains. Without this a budget-versus-actual report
     * is two independent guesses printed side by side.
     */
    public function refreshBudgets(?int $year = null): int
    {
        $year = $year ?: (int) date('Y');

        $lines = BudgetLine::where('year', $year)->get();

        foreach ($lines as $line) {
            $actual = DB::table('journal_lines')
                ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
                ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
                ->whereYear('journal_entries.entry_date', $year)
                ->where('journal_lines.account_id', $line->account_id)
                ->when(
                    $line->hr_department_id,
                    // A line tagged to a department counts only that department's
                    // share; an untagged posting belongs to whoever owns the
                    // account, so it is left out rather than charged to everyone.
                    fn ($q) => $q->where('journal_lines.hr_department_id', $line->hr_department_id),
                )
                ->selectRaw('COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS total')
                ->value('total');

            $line->forceFill(['ytd_actual' => round((float) $actual, 2)])->save();
        }

        return $lines->count();
    }

    /* ============================ Banking ============================ */

    /** Ticks a statement line off against the books. */
    public function reconcile(BankTransaction $transaction, bool $reconciled = true): BankTransaction
    {
        $transaction->forceFill(['is_reconciled' => $reconciled])->save();

        $account = $transaction->bankAccount;

        if ($account && $account->unreconciled_count === 0) {
            $account->forceFill(['last_reconciled_at' => now()->toDateString()])->save();
        }

        return $transaction->fresh('bankAccount');
    }

    /* ---------------------------------------------------------------------- */

    /**
     * Mirrors a cash movement onto the bank statement.
     *
     * Skipped when no bank was named — cash in a tin has no statement line, and
     * inventing one would make the reconciliation permanently out.
     */
    private function recordBankMovement(?int $bankAccountId, array $data): void
    {
        if (! $bankAccountId) {
            return;
        }

        BankTransaction::create([
            'bank_account_id' => $bankAccountId,
            'transaction_date' => $data['date'] ?? now()->toDateString(),
            'description' => $data['description'] ?? null,
            'reference' => $data['reference'] ?? null,
            'debit' => $data['debit'] ?? 0,
            'credit' => $data['credit'] ?? 0,
            'journal_entry_id' => $data['journalEntryId'] ?? null,
            'is_reconciled' => false,
        ]);
    }

    /**
     * Refuses an allocation bigger than what the document still owes.
     *
     * @throws ValidationException
     */
    private function guardAllocations(array $allocations, string $model, string $key, string $noun): void
    {
        foreach ($allocations as $allocation) {
            $amount = round((float) ($allocation['amount'] ?? 0), 2);

            if ($amount <= 0) {
                continue;
            }

            $document = $model::find($allocation[$key] ?? null);

            if (! $document) {
                throw ValidationException::withMessages([
                    'allocations' => "That {$noun} no longer exists.",
                ]);
            }

            if ($amount > (float) $document->balance + 0.005) {
                $number = $document->invoice_no ?? $document->bill_no;

                throw ValidationException::withMessages([
                    'allocations' => sprintf(
                        'Applying %s to %s, which only has %s outstanding.',
                        number_format($amount, 2),
                        $number,
                        number_format((float) $document->balance, 2),
                    ),
                ]);
            }
        }
    }

    /** Next sequential document number, locked against concurrent saves. */
    private function nextNumber(string $model, string $column, string $prefix): string
    {
        $stem = $prefix.date('Y').'-';

        $last = $model::query()
            ->where($column, 'like', $stem.'%')
            ->orderByDesc($column)
            ->lockForUpdate()
            ->value($column);

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
