<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApBill;
use App\Models\ArInvoice;
use App\Models\BankAccount;
use App\Models\Expense;
use App\Models\FixedAsset;
use App\Models\JournalEntry;
use App\Models\TaxFiling;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The Finance dashboard, computed from the ledger and the sub-ledgers.
 *
 * Cash is what the cash accounts hold, profit is what the P&L says, and the
 * ageing buckets are the ones the AR and AP screens show — so the headline
 * figures and the lists behind them cannot tell different stories.
 */
class FinanceAnalytics
{
    private const MONTHS = 12;

    public function __construct(
        private readonly Ledger $ledger,
        private readonly FinanceStatements $statements,
    ) {}

    public function dashboard(): array
    {
        $now = CarbonImmutable::now();
        $yearStart = $this->ledger->fiscalYearStart()->toDateString();

        $pl = $this->statements->profitAndLoss($yearStart, $now->toDateString());
        $bs = $this->statements->balanceSheet($now->toDateString());
        $trial = $this->ledger->trialBalance();

        return [
            'kpis' => $this->kpis($pl, $bs, $trial, $now),
            'trend' => $this->trend($now),
            'cashByAccount' => $this->cashByAccount(),
            'receivableAgeing' => $this->ageing(ArInvoice::class, ArInvoice::OPEN_STATUSES),
            'payableAgeing' => $this->ageing(ApBill::class, ApBill::OPEN_STATUSES),
            'expenseByCategory' => $this->expenseByCategory($yearStart),
            'topDebtors' => $this->topDebtors(),
            'upcomingObligations' => $this->upcomingObligations($now),
            'generatedAt' => $now->toIso8601String(),
        ];
    }

    /* ---------------------------------------------------------------------- */

    private function kpis(array $pl, array $bs, array $trial, CarbonImmutable $now): array
    {
        $receivables = ArInvoice::whereIn('status', ArInvoice::OPEN_STATUSES);
        $payables = ApBill::whereIn('status', ApBill::OPEN_STATUSES);

        $overdueAr = (clone $receivables)->where('days_overdue', '>', 0);
        $overdueAp = (clone $payables)->where('days_to_due', '<', 0);

        $cash = round(Account::where('subtype', 'Cash')->sum('balance'), 2);
        $revenue = $pl['totals']['revenue'];

        // Days sales outstanding: how long the average peso takes to arrive.
        // Null without revenue — dividing by nothing produces a number that
        // looks like a collections crisis.
        $arBalance = round((clone $receivables)->sum('balance'), 2);
        $daysElapsed = max(1, (int) CarbonImmutable::parse($pl['from'])->diffInDays($now));

        return [
            'cashPosition' => $cash,
            'bankAccounts' => BankAccount::where('status', 'Active')->count(),
            'unreconciled' => (int) BankAccount::sum('unreconciled_count'),

            'receivables' => $arBalance,
            'receivablesOverdue' => round((clone $overdueAr)->sum('balance'), 2),
            'receivablesCount' => (clone $receivables)->count(),
            'overdueInvoices' => (clone $overdueAr)->count(),

            'payables' => round((clone $payables)->sum('balance'), 2),
            'payablesOverdue' => round((clone $overdueAp)->sum('balance'), 2),
            'payablesCount' => (clone $payables)->count(),
            'dueThisWeek' => round((clone $payables)
                ->whereBetween('days_to_due', [0, 7])
                ->sum('balance'), 2),

            'revenue' => $revenue,
            'grossProfit' => $pl['totals']['grossProfit'],
            'netProfit' => $pl['totals']['netProfit'],
            'grossMarginPct' => $pl['totals']['grossMarginPct'],
            'netMarginPct' => $pl['totals']['netMarginPct'],
            'opex' => $pl['totals']['opex'],

            'totalAssets' => $bs['totals']['assets'],
            'totalLiabilities' => $bs['totals']['liabilities'],
            'totalEquity' => $bs['totals']['equity'],
            'balanceSheetBalanced' => $bs['totals']['balanced'],

            // Working capital and the current ratio: can the company pay what
            // falls due? Null when there is nothing owed, since dividing by
            // zero would report infinite health.
            'workingCapital' => round($arBalance + $cash - round((clone $payables)->sum('balance'), 2), 2),
            'daysSalesOutstanding' => $revenue > 0
                ? (int) round(($arBalance / $revenue) * $daysElapsed)
                : null,

            'draftJournals' => JournalEntry::where('status', 'Draft')->count(),
            'postedJournals' => JournalEntry::where('status', 'Posted')->count(),
            'trialBalanced' => $trial['balanced'],
            'trialDifference' => round($trial['totalDebit'] - $trial['totalCredit'], 2),

            'expenseClaims' => Expense::whereIn('status', ['Submitted', 'For Approval'])->count(),
            'expenseClaimsValue' => round(Expense::whereIn('status', ['Submitted', 'For Approval'])->sum('amount'), 2),

            'fixedAssetsNbv' => round(FixedAsset::whereNot('status', 'Disposed')->sum('net_book_value'), 2),
            'depreciationDue' => $this->assetsAwaitingDepreciation($now),

            'taxDue' => round(TaxFiling::whereNotIn('status', ['Filed', 'Paid'])->sum('tax_due'), 2),
            'taxOverdue' => TaxFiling::where('status', 'Overdue')->count(),
        ];
    }

    /** Revenue, expense and profit month by month, straight from the ledger. */
    private function trend(CarbonImmutable $now): array
    {
        $start = $now->startOfMonth()->subMonths(self::MONTHS - 1);

        $rows = DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
            ->whereDate('journal_entries.entry_date', '>=', $start->toDateString())
            ->whereIn('accounts.type', ['Revenue', 'Expense'])
            ->selectRaw("DATE_FORMAT(journal_entries.entry_date, '%Y-%m') AS ym, accounts.type, accounts.subtype,
                COALESCE(SUM(journal_lines.debit), 0) AS debit,
                COALESCE(SUM(journal_lines.credit), 0) AS credit")
            ->groupBy('ym', 'accounts.type', 'accounts.subtype')
            ->get()
            ->groupBy('ym');

        $months = [];
        for ($i = self::MONTHS - 1; $i >= 0; $i--) {
            $month = $now->startOfMonth()->subMonths($i);
            $key = $month->format('Y-m');
            $group = $rows->get($key, collect());

            $revenue = round($group->where('type', 'Revenue')
                ->sum(fn ($r) => (float) $r->credit - (float) $r->debit), 2);
            $cogs = round($group->where('subtype', 'COGS')
                ->sum(fn ($r) => (float) $r->debit - (float) $r->credit), 2);
            $expense = round($group->where('type', 'Expense')
                ->sum(fn ($r) => (float) $r->debit - (float) $r->credit), 2);

            $months[] = [
                'key' => $key,
                'month' => $month->format('M y'),
                'revenue' => $revenue,
                'cogs' => $cogs,
                'expenses' => round($expense - $cogs, 2),
                'grossProfit' => round($revenue - $cogs, 2),
                'netProfit' => round($revenue - $expense, 2),
            ];
        }

        return $months;
    }

    private function cashByAccount(): array
    {
        return BankAccount::query()
            ->where('status', '!=', 'Closed')
            ->orderByDesc('balance')
            ->get()
            ->map(fn (BankAccount $account) => [
                'name' => $account->name,
                'bank' => $account->bank,
                'type' => $account->type,
                'value' => round((float) $account->balance, 2),
                'unreconciled' => (int) $account->unreconciled_count,
                'lastReconciled' => optional($account->last_reconciled_at)->toDateString(),
            ])
            ->all();
    }

    /** Outstanding balance per ageing bucket, in the order collections works. */
    private function ageing(string $model, array $openStatuses): array
    {
        $buckets = ['Current', '1-30', '31-60', '61-90', '90+'];

        $totals = $model::query()
            ->whereIn('status', $openStatuses)
            ->selectRaw('ageing_bucket, COALESCE(SUM(balance), 0) AS total, COUNT(*) AS documents')
            ->groupBy('ageing_bucket')
            ->get()
            ->keyBy('ageing_bucket');

        return collect($buckets)
            ->map(fn (string $bucket) => [
                'name' => $bucket,
                'value' => round((float) ($totals[$bucket]->total ?? 0), 2),
                'documents' => (int) ($totals[$bucket]->documents ?? 0),
            ])
            ->filter(fn (array $row) => $row['documents'] > 0)
            ->values()
            ->all();
    }

    private function expenseByCategory(string $from): array
    {
        return Expense::query()
            ->whereIn('status', ['Approved', 'Liquidated'])
            ->whereDate('expense_date', '>=', $from)
            ->selectRaw('category, COALESCE(SUM(amount), 0) AS total')
            ->groupBy('category')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => ['name' => $row->category, 'value' => round((float) $row->total, 2)])
            ->all();
    }

    /** Who owes the most, worst first — the collections call list. */
    private function topDebtors(): array
    {
        return ArInvoice::query()
            ->with('customer')
            ->whereIn('status', ArInvoice::OPEN_STATUSES)
            ->get()
            ->groupBy('customer_id')
            ->map(fn ($invoices) => [
                'name' => $invoices->first()->customer->name ?? 'Unknown',
                'value' => round($invoices->sum(fn ($i) => (float) $i->balance), 2),
                'invoices' => $invoices->count(),
                'oldestDays' => (int) $invoices->max('days_overdue'),
            ])
            ->sortByDesc('value')
            ->take(8)
            ->values()
            ->all();
    }

    /** Bills and tax returns falling due, so nothing is missed by surprise. */
    private function upcomingObligations(CarbonImmutable $now): array
    {
        $bills = ApBill::query()
            ->with('supplier')
            ->whereIn('status', ApBill::OPEN_STATUSES)
            ->where('days_to_due', '<=', 30)
            ->orderBy('due_date')
            ->limit(10)
            ->get()
            ->map(fn (ApBill $bill) => [
                'kind' => 'Bill',
                'label' => $bill->bill_no,
                'party' => $bill->supplier->name ?? null,
                'due' => optional($bill->due_date)->toDateString(),
                'daysToDue' => (int) $bill->days_to_due,
                'amount' => round((float) $bill->balance, 2),
            ]);

        $filings = TaxFiling::query()
            ->whereNotIn('status', ['Filed', 'Paid'])
            ->orderBy('due_date')
            ->limit(10)
            ->get()
            ->map(fn (TaxFiling $filing) => [
                'kind' => 'Tax',
                'label' => $filing->form,
                'party' => $filing->period,
                'due' => optional($filing->due_date)->toDateString(),
                'daysToDue' => $filing->days_to_due ?? 0,
                'amount' => round((float) $filing->tax_due, 2),
            ]);

        return $bills->concat($filings)
            ->sortBy('daysToDue')
            ->take(12)
            ->values()
            ->all();
    }

    /** How many assets still owe a depreciation charge for this month. */
    private function assetsAwaitingDepreciation(CarbonImmutable $now): int
    {
        $month = $now->startOfMonth();

        return FixedAsset::query()
            ->whereNotIn('status', ['Disposed', 'Impaired'])
            ->get()
            ->filter(fn (FixedAsset $asset) => $asset->chargeableFor($month) > 0)
            ->count();
    }
}
