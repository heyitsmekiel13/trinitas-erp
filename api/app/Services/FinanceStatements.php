<?php

namespace App\Services;

use App\Models\Account;
use App\Models\JournalEntry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The three statements, assembled from the general ledger.
 *
 * The screen already claimed they were "assembled from the general ledger".
 * They were not: operating expenses were split by hardcoded percentages
 * (44% salaries, 16% rent…), investing activities were the PPE balance times
 * 0.08, and financing was a loan balance times 0.05. Every figure was invented
 * and none of it would survive being checked against a single journal.
 *
 * Everything here comes from posted journal lines. Where there is no data, the
 * line reads zero — which is the truth about a company that has not traded yet,
 * and far more useful than a plausible number.
 */
class FinanceStatements
{
    public function __construct(private readonly Ledger $ledger) {}

    /**
     * Profit and loss for a period.
     *
     * Revenue and expenses are period movements, not balances: what was earned
     * and spent between two dates.
     */
    public function profitAndLoss(?string $from = null, ?string $to = null): array
    {
        [$from, $to] = $this->range($from, $to);

        $movements = $this->movements($from, $to);

        $revenue = $this->sumFor($movements, 'Revenue', ['Operating']);
        $otherIncome = $this->sumFor($movements, 'Revenue', ['Non-operating']);
        $contra = $this->sumFor($movements, 'Revenue', ['Contra-Revenue']);
        $cogs = $this->sumFor($movements, 'Expense', ['COGS']);

        // Every operating expense account, listed individually. This is the
        // part that used to be a set of made-up percentages.
        $opexAccounts = $this->accountsFor($movements, 'Expense', ['Operating']);
        $opex = round(array_sum(array_column($opexAccounts, 'amount')), 2);
        $nonOperating = $this->sumFor($movements, 'Expense', ['Non-operating']);

        $netRevenue = round($revenue - $contra, 2);
        $grossProfit = round($netRevenue - $cogs, 2);
        $operatingProfit = round($grossProfit - $opex, 2);
        $netProfit = round($operatingProfit + $otherIncome - $nonOperating, 2);

        $lines = [
            ['label' => 'Revenue', 'amount' => 0, 'level' => 0],
            ['label' => 'Sales — trade', 'amount' => $revenue, 'level' => 2],
            ['label' => 'Less: returns, allowances and discounts', 'amount' => -$contra, 'level' => 2],
            ['label' => 'Net revenue', 'amount' => $netRevenue, 'level' => 1, 'emphasis' => true],

            ['label' => 'Cost of sales', 'amount' => 0, 'level' => 0],
            ['label' => 'Cost of goods sold', 'amount' => $cogs, 'level' => 2],
            ['label' => 'Gross profit', 'amount' => $grossProfit, 'level' => 1, 'emphasis' => true],

            ['label' => 'Operating expenses', 'amount' => 0, 'level' => 0],
        ];

        foreach ($opexAccounts as $account) {
            $lines[] = ['label' => $account['name'], 'amount' => $account['amount'], 'level' => 2];
        }

        if (! $opexAccounts) {
            $lines[] = ['label' => 'No operating expenses posted', 'amount' => 0, 'level' => 2];
        }

        $lines[] = ['label' => 'Total operating expenses', 'amount' => $opex, 'level' => 1, 'emphasis' => true];
        $lines[] = ['label' => 'Operating profit', 'amount' => $operatingProfit, 'level' => 1, 'emphasis' => true];

        if ($otherIncome || $nonOperating) {
            $lines[] = ['label' => 'Other income and expense', 'amount' => 0, 'level' => 0];
            $lines[] = ['label' => 'Other income', 'amount' => $otherIncome, 'level' => 2];
            $lines[] = ['label' => 'Interest and other expense', 'amount' => -$nonOperating, 'level' => 2];
        }

        $lines[] = ['label' => 'Result', 'amount' => 0, 'level' => 0];
        $lines[] = ['label' => 'Net profit before tax', 'amount' => $netProfit, 'level' => 1, 'emphasis' => true];

        return [
            'title' => 'Statement of Comprehensive Income',
            'from' => $from,
            'to' => $to,
            'lines' => $lines,
            'totals' => [
                'revenue' => $netRevenue,
                'cogs' => $cogs,
                'grossProfit' => $grossProfit,
                'opex' => $opex,
                'netProfit' => $netProfit,
                'grossMarginPct' => $netRevenue > 0 ? round(($grossProfit / $netRevenue) * 100, 1) : null,
                'netMarginPct' => $netRevenue > 0 ? round(($netProfit / $netRevenue) * 100, 1) : null,
            ],
        ];
    }

    /**
     * Balance sheet as at a date.
     *
     * Assets and liabilities are cumulative balances rather than period
     * movements. Retained earnings is the accumulated result of every revenue
     * and expense posting ever made, which is what makes the sheet balance
     * without anyone plugging a difference.
     */
    public function balanceSheet(?string $asAt = null): array
    {
        $asAt = $asAt ?: CarbonImmutable::now()->toDateString();

        $balances = $this->movements(null, $asAt);

        $currentAssets = $this->accountsFor($balances, 'Asset', ['Cash', 'Receivable', 'Inventory', 'Tax', 'Prepayment', 'Contra-Asset'], excludeSubtypes: ['Fixed Asset']);
        // Accumulated depreciation is a contra-asset sitting in the non-current
        // block, so it is pulled out of current assets by code.
        $currentAssets = array_values(array_filter($currentAssets, fn ($a) => $a['code'] !== '1215'));

        $fixedAssets = $this->accountsFor($balances, 'Asset', ['Fixed Asset']);

        // Accumulated depreciation is a contra-asset: an account whose normal
        // side is Debit but which carries a credit balance, so it arrives here
        // already negative. It is *added*, not subtracted — taking it away
        // would remove it twice and leave the sheet out by double the figure.
        $accumDep = $this->balanceOf($balances, '1215');

        $totalCurrent = round(array_sum(array_column($currentAssets, 'amount')), 2);
        $totalFixed = round(array_sum(array_column($fixedAssets, 'amount')) + $accumDep, 2);
        $totalAssets = round($totalCurrent + $totalFixed, 2);

        $liabilityAccounts = $this->accountsFor($balances, 'Liability');
        $totalLiabilities = round(array_sum(array_column($liabilityAccounts, 'amount')), 2);

        $equityAccounts = $this->accountsFor($balances, 'Equity');
        $postedEquity = round(array_sum(array_column($equityAccounts, 'amount')), 2);

        // Everything earned and spent to date, which has not been closed out to
        // retained earnings by a year-end entry.
        $result = $this->profitAndLoss($this->ledger->fiscalYearStart($asAt)->toDateString(), $asAt);
        $currentEarnings = $result['totals']['netProfit'];

        $totalEquity = round($postedEquity + $currentEarnings, 2);

        $lines = [['label' => 'Assets', 'amount' => 0, 'level' => 0]];

        foreach ($currentAssets as $account) {
            $lines[] = ['label' => $account['name'], 'amount' => $account['amount'], 'level' => 2];
        }
        $lines[] = ['label' => 'Total current assets', 'amount' => $totalCurrent, 'level' => 1, 'emphasis' => true];

        foreach ($fixedAssets as $account) {
            $lines[] = ['label' => $account['name'], 'amount' => $account['amount'], 'level' => 2];
        }
        if ($accumDep) {
            // Already negative, so it prints as a deduction without negating.
            $lines[] = ['label' => 'Less: accumulated depreciation', 'amount' => $accumDep, 'level' => 2];
        }
        $lines[] = ['label' => 'Total non-current assets', 'amount' => $totalFixed, 'level' => 1, 'emphasis' => true];
        $lines[] = ['label' => 'Total assets', 'amount' => $totalAssets, 'level' => 1, 'emphasis' => true];

        $lines[] = ['label' => 'Liabilities', 'amount' => 0, 'level' => 0];
        foreach ($liabilityAccounts as $account) {
            $lines[] = ['label' => $account['name'], 'amount' => $account['amount'], 'level' => 2];
        }
        $lines[] = ['label' => 'Total liabilities', 'amount' => $totalLiabilities, 'level' => 1, 'emphasis' => true];

        $lines[] = ['label' => 'Equity', 'amount' => 0, 'level' => 0];
        foreach ($equityAccounts as $account) {
            $lines[] = ['label' => $account['name'], 'amount' => $account['amount'], 'level' => 2];
        }
        $lines[] = ['label' => 'Result for the period', 'amount' => $currentEarnings, 'level' => 2];
        $lines[] = ['label' => 'Total equity', 'amount' => $totalEquity, 'level' => 1, 'emphasis' => true];
        $lines[] = [
            'label' => 'Total liabilities and equity',
            'amount' => round($totalLiabilities + $totalEquity, 2),
            'level' => 1,
            'emphasis' => true,
        ];

        $difference = round($totalAssets - ($totalLiabilities + $totalEquity), 2);

        return [
            'title' => 'Statement of Financial Position',
            'asAt' => $asAt,
            'lines' => $lines,
            'totals' => [
                'assets' => $totalAssets,
                'liabilities' => $totalLiabilities,
                'equity' => $totalEquity,
                // Shown rather than hidden. If this is not zero the ledger has
                // a problem, and the statement should be the thing that says so.
                'difference' => $difference,
                'balanced' => abs($difference) <= 0.005,
            ],
        ];
    }

    /**
     * Cash flow for a period, direct method.
     *
     * Built from what actually moved through the cash and bank accounts, which
     * is the only version of this statement that can be checked against a bank
     * statement. Each cash movement is classified by what sat on the other side
     * of its journal entry.
     */
    public function cashFlow(?string $from = null, ?string $to = null): array
    {
        [$from, $to] = $this->range($from, $to);

        $cashAccountIds = Account::where('subtype', 'Cash')->pluck('id')->all();

        if (! $cashAccountIds) {
            return $this->emptyCashFlow($from, $to);
        }

        // Every journal that touched cash in the period, with the cash movement
        // it caused.
        $cashMoves = DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
            ->whereIn('journal_lines.account_id', $cashAccountIds)
            ->whereDate('journal_entries.entry_date', '>=', $from)
            ->whereDate('journal_entries.entry_date', '<=', $to)
            ->groupBy('journal_lines.journal_entry_id')
            ->selectRaw('journal_lines.journal_entry_id AS entry_id,
                COALESCE(SUM(journal_lines.debit), 0) AS money_in,
                COALESCE(SUM(journal_lines.credit), 0) AS money_out,
                COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS net')
            ->get()
            ->keyBy('entry_id');

        if ($cashMoves->isEmpty()) {
            return $this->emptyCashFlow($from, $to);
        }

        // The counterpart accounts decide which activity the movement belongs
        // to: buying equipment is investing, a loan is financing, everything
        // else is the business operating.
        $counterparts = DB::table('journal_lines')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereIn('journal_lines.journal_entry_id', $cashMoves->keys())
            ->whereNotIn('journal_lines.account_id', $cashAccountIds)
            ->selectRaw('journal_lines.journal_entry_id AS entry_id, accounts.subtype, accounts.type,
                COALESCE(SUM(journal_lines.debit + journal_lines.credit), 0) AS weight')
            ->groupBy('journal_lines.journal_entry_id', 'accounts.subtype', 'accounts.type')
            ->get()
            ->groupBy('entry_id');

        $buckets = ['operating' => 0.0, 'investing' => 0.0, 'financing' => 0.0];
        // In and out are tracked per activity too, so the detail lines under a
        // subtotal actually add up to it.
        $flows = ['operating' => ['in' => 0.0, 'out' => 0.0]];

        foreach ($cashMoves as $entryId => $move) {
            $rows = $counterparts->get($entryId, collect());

            // The dominant counterpart classifies the entry. A receipt whose
            // other side is receivables is operating; one against a loan is not.
            $dominant = $rows->sortByDesc('weight')->first();

            $activity = match (true) {
                $dominant === null => 'operating',
                $dominant->subtype === 'Fixed Asset' => 'investing',
                in_array($dominant->subtype, ['Loan', 'Capital', 'Earnings'], true) => 'financing',
                default => 'operating',
            };

            $buckets[$activity] += (float) $move->net;

            if ($activity === 'operating') {
                $flows['operating']['in'] += (float) $move->money_in;
                $flows['operating']['out'] += (float) $move->money_out;
            }
        }

        $operating = round($buckets['operating'], 2);
        $investing = round($buckets['investing'], 2);
        $financing = round($buckets['financing'], 2);
        $netMovement = round($operating + $investing + $financing, 2);

        $opening = $this->cashBalanceAt(CarbonImmutable::parse($from)->subDay()->toDateString(), $cashAccountIds);
        $closing = round($opening + $netMovement, 2);

        // Collections and disbursements within operating activities only.
        $inflow = round($flows['operating']['in'], 2);
        $outflow = round($flows['operating']['out'], 2);

        return [
            'title' => 'Statement of Cash Flows',
            'from' => $from,
            'to' => $to,
            'lines' => [
                ['label' => 'Operating activities', 'amount' => 0, 'level' => 0],
                ['label' => 'Cash received', 'amount' => $inflow, 'level' => 2],
                ['label' => 'Cash paid out', 'amount' => -$outflow, 'level' => 2],
                ['label' => 'Net cash from operating activities', 'amount' => $operating, 'level' => 1, 'emphasis' => true],

                ['label' => 'Investing activities', 'amount' => 0, 'level' => 0],
                ['label' => 'Property and equipment', 'amount' => $investing, 'level' => 2],
                ['label' => 'Net cash from investing activities', 'amount' => $investing, 'level' => 1, 'emphasis' => true],

                ['label' => 'Financing activities', 'amount' => 0, 'level' => 0],
                ['label' => 'Loans and capital', 'amount' => $financing, 'level' => 2],
                ['label' => 'Net cash from financing activities', 'amount' => $financing, 'level' => 1, 'emphasis' => true],

                ['label' => 'Summary', 'amount' => 0, 'level' => 0],
                ['label' => 'Opening cash balance', 'amount' => $opening, 'level' => 2],
                ['label' => 'Net movement in cash', 'amount' => $netMovement, 'level' => 2],
                ['label' => 'Closing cash balance', 'amount' => $closing, 'level' => 1, 'emphasis' => true],
            ],
            'totals' => [
                'operating' => $operating,
                'investing' => $investing,
                'financing' => $financing,
                'netMovement' => $netMovement,
                'opening' => $opening,
                'closing' => $closing,
            ],
        ];
    }

    /* ---------------------------------------------------------------------- */

    /**
     * Net movement per account over a window, in the account's own direction.
     *
     * @return Collection<int, object>
     */
    private function movements(?string $from, ?string $to): Collection
    {
        return DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
            ->when($from, fn ($q) => $q->whereDate('journal_entries.entry_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('journal_entries.entry_date', '<=', $to))
            ->groupBy('accounts.id', 'accounts.code', 'accounts.name', 'accounts.type', 'accounts.subtype', 'accounts.normal_balance')
            ->orderBy('accounts.code')
            ->selectRaw('accounts.code, accounts.name, accounts.type, accounts.subtype, accounts.normal_balance,
                COALESCE(SUM(journal_lines.debit), 0) AS debit,
                COALESCE(SUM(journal_lines.credit), 0) AS credit')
            ->get()
            ->map(function ($row) {
                $row->amount = round($row->normal_balance === 'Debit'
                    ? (float) $row->debit - (float) $row->credit
                    : (float) $row->credit - (float) $row->debit, 2);

                return $row;
            });
    }

    /** @return array<int, array{code: string, name: string, amount: float}> */
    private function accountsFor(
        Collection $movements,
        string $type,
        ?array $subtypes = null,
        array $excludeSubtypes = [],
    ): array {
        return $movements
            ->filter(fn ($row) => $row->type === $type)
            ->filter(fn ($row) => $subtypes === null || in_array($row->subtype, $subtypes, true))
            ->filter(fn ($row) => ! in_array($row->subtype, $excludeSubtypes, true))
            // An account with no movement is noise on a statement.
            ->filter(fn ($row) => abs($row->amount) > 0.005)
            ->map(fn ($row) => ['code' => $row->code, 'name' => $row->name, 'amount' => $row->amount])
            ->values()
            ->all();
    }

    private function sumFor(Collection $movements, string $type, ?array $subtypes = null): float
    {
        return round(array_sum(array_column($this->accountsFor($movements, $type, $subtypes), 'amount')), 2);
    }

    private function balanceOf(Collection $movements, string $code): float
    {
        return (float) ($movements->firstWhere('code', $code)->amount ?? 0);
    }

    /** Cash and bank balance as at the end of a date. */
    private function cashBalanceAt(string $date, array $cashAccountIds): float
    {
        $totals = DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
            ->whereIn('journal_lines.account_id', $cashAccountIds)
            ->whereDate('journal_entries.entry_date', '<=', $date)
            ->selectRaw('COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit')
            ->first();

        return round((float) $totals->debit - (float) $totals->credit, 2);
    }

    private function emptyCashFlow(string $from, string $to): array
    {
        return [
            'title' => 'Statement of Cash Flows',
            'from' => $from,
            'to' => $to,
            'lines' => [
                ['label' => 'Summary', 'amount' => 0, 'level' => 0],
                ['label' => 'No cash movement posted in this period', 'amount' => 0, 'level' => 2],
            ],
            'totals' => [
                'operating' => 0.0, 'investing' => 0.0, 'financing' => 0.0,
                'netMovement' => 0.0, 'opening' => 0.0, 'closing' => 0.0,
            ],
        ];
    }

    /** Defaults to the fiscal year to date. */
    private function range(?string $from, ?string $to): array
    {
        $to = $to ?: CarbonImmutable::now()->toDateString();
        $from = $from ?: $this->ledger->fiscalYearStart($to)->toDateString();

        return [$from, $to];
    }
}
