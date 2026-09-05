<?php

namespace App\Services;

use App\Models\Account;
use App\Models\JournalEntry;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The general ledger. The only code permitted to post a journal entry.
 *
 * The finance migration promised that "the balanced-debits-equals-credits rule
 * is enforced by the posting service, which is the only code permitted to set a
 * journal's status to Posted". Nothing implemented it, which meant an account
 * balance was a number somebody typed and a trial balance could not be trusted
 * to balance.
 *
 * Two rules make the rest of Finance honest:
 *
 *  - A journal posts only if its debits equal its credits, to the centavo.
 *  - An account's balance is the sum of what has been posted to it. It is
 *    never incremented in place, so a balance cannot drift away from the lines
 *    that are supposed to explain it.
 *
 * A posted entry is never edited or deleted. Corrections are reversals: a new
 * entry with the sides swapped, pointing back at what it undoes.
 */
class Ledger
{
    /** Tolerance for the balance check — money is two decimal places. */
    private const EPSILON = 0.005;

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Posts a journal to the ledger.
     *
     * @throws ValidationException
     */
    public function post(JournalEntry $entry, ?string $memo = null): JournalEntry
    {
        if ($entry->status === 'Posted') {
            throw ValidationException::withMessages([
                'status' => "{$entry->journal_no} is already posted. Reverse it instead of posting it again.",
            ]);
        }

        if ($entry->status === 'Reversed') {
            throw ValidationException::withMessages([
                'status' => "{$entry->journal_no} has been reversed and cannot be posted again.",
            ]);
        }

        return DB::transaction(function () use ($entry, $memo) {
            $lines = $entry->lines()->with('account')->get();

            if ($lines->isEmpty()) {
                throw ValidationException::withMessages([
                    'lines' => 'A journal entry needs at least one line before it can be posted.',
                ]);
            }

            $debit = round($lines->sum(fn ($l) => (float) $l->debit), 2);
            $credit = round($lines->sum(fn ($l) => (float) $l->credit), 2);

            if (abs($debit - $credit) > self::EPSILON) {
                throw ValidationException::withMessages([
                    'lines' => sprintf(
                        'Debits and credits must balance. Debits total %s, credits total %s — a difference of %s.',
                        number_format($debit, 2),
                        number_format($credit, 2),
                        number_format(abs($debit - $credit), 2),
                    ),
                ]);
            }

            if ($debit <= 0) {
                throw ValidationException::withMessages([
                    'lines' => 'A journal entry with nothing on either side has nothing to post.',
                ]);
            }

            // Header accounts exist to group the tree, not to carry balances.
            $headers = $lines->filter(fn ($l) => $l->account && ! $l->account->is_postable);
            if ($headers->isNotEmpty()) {
                throw ValidationException::withMessages([
                    'lines' => 'Cannot post to '.$headers->first()->account->code.' — it is a heading, not a postable account.',
                ]);
            }

            $entry->forceFill([
                'total_debit' => $debit,
                'total_credit' => $credit,
                'status' => 'Posted',
                'posted_by' => auth()->id(),
                'posted_at' => now(),
                'memo' => $memo ?? $entry->memo,
            ])->save();

            $this->refreshAccounts($lines->pluck('account_id')->unique()->all());

            $this->audit->log('posted a journal entry', 'JournalEntry', $entry->id, $entry->journal_no, 'finance');

            return $entry->fresh('lines');
        });
    }

    /**
     * Reverses a posted entry with a mirror-image entry.
     *
     * Deliberately not a delete: "we posted this and then took it back" is a
     * different fact from "this never happened", and only one of them survives
     * an audit.
     *
     * @throws ValidationException
     */
    public function reverse(JournalEntry $entry, ?string $reason = null, ?string $date = null): JournalEntry
    {
        if ($entry->status !== 'Posted') {
            throw ValidationException::withMessages([
                'status' => 'Only a posted entry can be reversed.',
            ]);
        }

        return DB::transaction(function () use ($entry, $reason, $date) {
            $reversal = JournalEntry::create([
                'journal_no' => $this->nextNumber(),
                'entry_date' => $date ?? now()->toDateString(),
                'memo' => $reason
                    ? "Reversal of {$entry->journal_no} — {$reason}"
                    : "Reversal of {$entry->journal_no}",
                'source' => $entry->source,
                'reference_type' => $entry->reference_type,
                'reference_id' => $entry->reference_id,
                'reverses_id' => $entry->id,
                'prepared_by' => auth()->id(),
                'status' => 'Draft',
            ]);

            foreach ($entry->lines as $line) {
                $reversal->lines()->create([
                    'account_id' => $line->account_id,
                    'description' => $line->description,
                    // The swap is the reversal.
                    'debit' => $line->credit,
                    'credit' => $line->debit,
                    'hr_department_id' => $line->hr_department_id,
                ]);
            }

            $this->post($reversal);

            $entry->forceFill(['status' => 'Reversed'])->save();
            $this->refreshAccounts($entry->lines->pluck('account_id')->unique()->all());

            return $reversal->fresh('lines');
        });
    }

    /**
     * Builds a journal from plain line data and posts it in one step.
     *
     * Every automatic posting in the system comes through here — a customer
     * receipt, a supplier payment, a depreciation run — so they all land in the
     * ledger the same way a manual entry does, and all of them balance.
     *
     * @param  array<int, array{account: string|int, debit?: float, credit?: float, description?: string, departmentId?: int}>  $lines
     *
     * @throws ValidationException
     */
    public function postDocument(
        string $source,
        string $memo,
        array $lines,
        ?Model $reference = null,
        ?string $date = null,
    ): JournalEntry {
        return DB::transaction(function () use ($source, $memo, $lines, $reference, $date) {
            $entry = JournalEntry::create([
                'journal_no' => $this->nextNumber(),
                'entry_date' => $date ?? now()->toDateString(),
                'memo' => $memo,
                'source' => $source,
                'reference_type' => $reference ? class_basename($reference) : null,
                'reference_id' => $reference?->getKey(),
                'prepared_by' => auth()->id(),
                'status' => 'Draft',
            ]);

            foreach ($lines as $line) {
                $amountDebit = round((float) ($line['debit'] ?? 0), 2);
                $amountCredit = round((float) ($line['credit'] ?? 0), 2);

                // A line with nothing on it is noise in the ledger.
                if ($amountDebit <= 0 && $amountCredit <= 0) {
                    continue;
                }

                $entry->lines()->create([
                    'account_id' => $this->accountId($line['account']),
                    'description' => $line['description'] ?? null,
                    'debit' => $amountDebit,
                    'credit' => $amountCredit,
                    'hr_department_id' => $line['departmentId'] ?? null,
                ]);
            }

            return $this->post($entry);
        });
    }

    /**
     * Recomputes an account's balance from the lines posted to it.
     *
     * Expressed in the account's own normal direction, so a healthy asset and a
     * healthy liability both read as a positive number — which is what every
     * statement and every accountant expects to see.
     *
     * @param  array<int, int>|null  $accountIds  Null recalculates everything.
     */
    public function refreshAccounts(?array $accountIds = null): int
    {
        $accounts = Account::query()
            ->when($accountIds !== null, fn ($q) => $q->whereIn('id', $accountIds))
            ->get();

        foreach ($accounts as $account) {
            $totals = DB::table('journal_lines')
                ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
                ->where('journal_lines.account_id', $account->id)
                ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
                ->selectRaw('COALESCE(SUM(journal_lines.debit), 0) AS debit, COALESCE(SUM(journal_lines.credit), 0) AS credit')
                ->first();

            $balance = $account->normal_balance === 'Debit'
                ? (float) $totals->debit - (float) $totals->credit
                : (float) $totals->credit - (float) $totals->debit;

            $account->forceFill(['balance' => round($balance, 2)])->save();
        }

        // A heading's balance is the sum of what sits under it, worked out from
        // the deepest level up so a parent never reads a stale child.
        foreach (Account::where('is_postable', false)->orderByDesc('level')->get() as $header) {
            $header->forceFill([
                'balance' => round(Account::where('parent_id', $header->id)->sum('balance'), 2),
            ])->save();
        }

        return $accounts->count();
    }

    /**
     * Debit and credit totals per account for a period.
     *
     * The one report that proves the ledger is sound: if the two columns differ
     * by a centavo, something got in without going through `post`.
     *
     * @return array{rows: array<int, array<string, mixed>>, totalDebit: float, totalCredit: float, balanced: bool}
     */
    public function trialBalance(?string $from = null, ?string $to = null): array
    {
        $rows = DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereIn('journal_entries.status', JournalEntry::IN_LEDGER)
            ->when($from, fn ($q) => $q->whereDate('journal_entries.entry_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('journal_entries.entry_date', '<=', $to))
            ->groupBy('accounts.id', 'accounts.code', 'accounts.name', 'accounts.type', 'accounts.normal_balance')
            ->orderBy('accounts.code')
            ->selectRaw('accounts.code, accounts.name, accounts.type, accounts.normal_balance,
                COALESCE(SUM(journal_lines.debit), 0) AS debit,
                COALESCE(SUM(journal_lines.credit), 0) AS credit')
            ->get()
            ->map(fn ($row) => [
                'code' => $row->code,
                'name' => $row->name,
                'type' => $row->type,
                'debit' => round((float) $row->debit, 2),
                'credit' => round((float) $row->credit, 2),
                'balance' => round($row->normal_balance === 'Debit'
                    ? (float) $row->debit - (float) $row->credit
                    : (float) $row->credit - (float) $row->debit, 2),
            ])
            ->all();

        $totalDebit = round(array_sum(array_column($rows, 'debit')), 2);
        $totalCredit = round(array_sum(array_column($rows, 'credit')), 2);

        return [
            'rows' => $rows,
            'totalDebit' => $totalDebit,
            'totalCredit' => $totalCredit,
            'balanced' => abs($totalDebit - $totalCredit) <= self::EPSILON,
            'from' => $from,
            'to' => $to,
        ];
    }

    /* ---------------------------------------------------------------------- */

    /** Resolves an account by id or by code, so callers can use either. */
    public function accountId(string|int $account): int
    {
        if (is_int($account) || ctype_digit((string) $account) && strlen((string) $account) > 4) {
            return (int) $account;
        }

        $id = Account::where('code', $account)->value('id');

        if (! $id) {
            throw ValidationException::withMessages([
                'account' => "No account with code {$account}. Check the chart of accounts.",
            ]);
        }

        return (int) $id;
    }

    /** Next sequential journal number, locked against concurrent saves. */
    public function nextNumber(): string
    {
        $stem = 'JV-'.date('Y').'-';

        $last = JournalEntry::query()
            ->where('journal_no', 'like', $stem.'%')
            ->orderByDesc('journal_no')
            ->lockForUpdate()
            ->value('journal_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }

    /** Start of the fiscal year the given date falls in. */
    public function fiscalYearStart(?string $on = null): CarbonImmutable
    {
        $date = $on ? CarbonImmutable::parse($on) : CarbonImmutable::now();
        $startMonth = (int) (app(Settings::class)->get('company', 'fiscal_year_start') ?? 1) ?: 1;

        $start = $date->startOfYear()->addMonths($startMonth - 1);

        return $start->gt($date) ? $start->subYear() : $start;
    }
}
