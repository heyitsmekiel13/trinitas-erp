<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApBill;
use App\Models\ArInvoice;
use App\Models\BankTransaction;
use App\Models\Expense;
use App\Models\JournalEntry;
use App\Models\TaxFiling;
use App\Services\FinanceAnalytics;
use App\Services\FinanceOperations;
use App\Services\FinanceStatements;
use App\Services\Ledger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Finance endpoints with behaviour of their own.
 *
 * The registry serves the lists. These are the things it cannot express: the
 * ledger postings, the statements assembled from them, and the trial balance
 * that proves the two agree.
 */
class FinanceController extends Controller
{
    public function dashboard(FinanceAnalytics $analytics): JsonResponse
    {
        return response()->json([
            'data' => Cache::remember('finance-dashboard', 60, fn () => $analytics->dashboard()),
        ]);
    }

    /* ============================= Ledger ============================ */

    /** Posts a journal entry. Refuses anything that does not balance. */
    public function postJournal(JournalEntry $journal, Ledger $ledger): JsonResponse
    {
        $entry = $ledger->post($journal);

        return response()->json([
            'data' => [
                'id' => $entry->id,
                'no' => $entry->journal_no,
                'debit' => (float) $entry->total_debit,
                'credit' => (float) $entry->total_credit,
                'status' => $entry->status,
                'postedAt' => optional($entry->posted_at)->toIso8601String(),
            ],
        ]);
    }

    /** Reverses a posted entry with a mirror-image entry. */
    public function reverseJournal(Request $request, JournalEntry $journal, Ledger $ledger): JsonResponse
    {
        $data = $request->validate([
            'reason' => 'nullable|string|max:190',
            'date' => 'nullable|date',
        ]);

        $reversal = $ledger->reverse($journal, $data['reason'] ?? null, $data['date'] ?? null);

        return response()->json([
            'data' => [
                'id' => $reversal->id,
                'no' => $reversal->journal_no,
                'reverses' => $journal->journal_no,
                'amount' => (float) $reversal->total_debit,
            ],
        ], 201);
    }

    /** Debits and credits per account — the proof the ledger is sound. */
    public function trialBalance(Request $request, Ledger $ledger): JsonResponse
    {
        $data = $request->validate([
            'from' => 'nullable|date',
            'to' => 'nullable|date',
        ]);

        return response()->json([
            'data' => $ledger->trialBalance($data['from'] ?? null, $data['to'] ?? null),
        ]);
    }

    /** Recomputes every account balance from the posted lines. */
    public function rebuildBalances(Ledger $ledger): JsonResponse
    {
        return response()->json(['data' => ['accounts' => $ledger->refreshAccounts()]]);
    }

    /* =========================== Statements ========================== */

    public function statements(Request $request, FinanceStatements $statements): JsonResponse
    {
        $data = $request->validate([
            'from' => 'nullable|date',
            'to' => 'nullable|date',
        ]);

        $from = $data['from'] ?? null;
        $to = $data['to'] ?? null;

        return response()->json([
            'data' => [
                'profitAndLoss' => $statements->profitAndLoss($from, $to),
                'balanceSheet' => $statements->balanceSheet($to),
                'cashFlow' => $statements->cashFlow($from, $to),
            ],
        ]);
    }

    /* ======================== Receivables ============================ */

    public function postInvoice(ArInvoice $invoice, FinanceOperations $operations): JsonResponse
    {
        $posted = $operations->postInvoice($invoice);

        return response()->json([
            'data' => [
                'id' => $posted->id,
                'no' => $posted->invoice_no,
                'amount' => (float) $posted->amount,
                'balance' => (float) $posted->balance,
                'status' => $posted->status,
            ],
        ]);
    }

    /** Records money in and applies it across the customer's invoices. */
    public function receivePayment(Request $request, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'customerId' => 'required|integer|exists:customers,id',
            'bankAccountId' => 'nullable|integer|exists:bank_accounts,id',
            'date' => 'nullable|date',
            'amount' => 'required|numeric|min:0.01',
            'method' => 'nullable|in:Cash,Cheque,Bank Transfer,Online,Card',
            'reference' => 'nullable|string|max:64',
            'receivedBy' => 'nullable|integer|exists:employees,id',
            'allocations' => 'nullable|array',
            'allocations.*.invoiceId' => 'required|integer|exists:ar_invoices,id',
            'allocations.*.amount' => 'required|numeric|min:0',
        ]);

        $receipt = $operations->receivePayment($data);

        return response()->json([
            'data' => [
                'id' => $receipt->id,
                'no' => $receipt->receipt_no,
                'amount' => (float) $receipt->amount,
                'unapplied' => (float) $receipt->unapplied,
                'applied' => $receipt->allocations->count(),
                'settled' => $receipt->allocations
                    ->filter(fn ($a) => (float) ($a->invoice->balance ?? 0) <= 0.005)
                    ->count(),
            ],
        ], 201);
    }

    /* ========================== Payables ============================= */

    public function postBill(ApBill $bill, FinanceOperations $operations): JsonResponse
    {
        $posted = $operations->postBill($bill);

        return response()->json([
            'data' => [
                'id' => $posted->id,
                'no' => $posted->bill_no,
                'amount' => (float) $posted->amount,
                'balance' => (float) $posted->balance,
                'status' => $posted->status,
            ],
        ]);
    }

    public function payBills(Request $request, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'supplierId' => 'required|integer|exists:suppliers,id',
            'bankAccountId' => 'nullable|integer|exists:bank_accounts,id',
            'date' => 'nullable|date',
            'amount' => 'required|numeric|min:0.01',
            'method' => 'nullable|in:Cash,Cheque,Bank Transfer,Online',
            'reference' => 'nullable|string|max:64',
            'allocations' => 'nullable|array',
            'allocations.*.billId' => 'required|integer|exists:ap_bills,id',
            'allocations.*.amount' => 'required|numeric|min:0',
        ]);

        $payment = $operations->payBills($data);

        return response()->json([
            'data' => [
                'id' => $payment->id,
                'no' => $payment->payment_no,
                'amount' => (float) $payment->amount,
                'unapplied' => (float) $payment->unapplied,
                'applied' => $payment->allocations->count(),
                'settled' => $payment->allocations
                    ->filter(fn ($a) => (float) ($a->bill->balance ?? 0) <= 0.005)
                    ->count(),
            ],
        ], 201);
    }

    /* =========================== Expenses ============================ */

    public function approveExpense(Expense $expense, FinanceOperations $operations): JsonResponse
    {
        $approved = $operations->approveExpense($expense);

        return response()->json([
            'data' => [
                'id' => $approved->id,
                'no' => $approved->expense_no,
                'amount' => (float) $approved->amount,
                'account' => $approved->account->name ?? null,
                'journalNo' => $approved->journalEntry->journal_no ?? null,
                'status' => $approved->status,
            ],
        ]);
    }

    /* ========================= Fixed assets ========================== */

    public function runDepreciation(Request $request, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate(['month' => 'nullable|date']);

        $result = $operations->runDepreciation($data['month'] ?? null);

        return response()->json(['data' => $result], $result['posted'] ? 201 : 200);
    }

    /* ============================= Tax =============================== */

    public function fileTax(Request $request, TaxFiling $taxFiling, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'filedOn' => 'nullable|date',
            'confirmationNo' => 'nullable|string|max:64',
        ]);

        $filed = $operations->fileTax($taxFiling, $data);

        return response()->json([
            'data' => [
                'id' => $filed->id,
                'form' => $filed->form,
                'period' => $filed->period,
                'filedOn' => optional($filed->filed_on)->toDateString(),
                'status' => $filed->status,
            ],
        ]);
    }

    /* =========================== Budgets ============================= */

    public function refreshBudgets(Request $request, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate(['year' => 'nullable|integer|min:2000|max:2100']);

        return response()->json([
            'data' => ['lines' => $operations->refreshBudgets($data['year'] ?? null)],
        ]);
    }

    /* =========================== Banking ============================= */

    public function reconcile(Request $request, BankTransaction $bankTransaction, FinanceOperations $operations): JsonResponse
    {
        $data = $request->validate(['reconciled' => 'nullable|boolean']);

        $row = $operations->reconcile($bankTransaction, $data['reconciled'] ?? true);

        return response()->json([
            'data' => [
                'id' => $row->id,
                'reconciled' => (bool) $row->is_reconciled,
                'unreconciled' => (int) ($row->bankAccount->unreconciled_count ?? 0),
                'balance' => (float) ($row->bankAccount->balance ?? 0),
            ],
        ]);
    }
}
