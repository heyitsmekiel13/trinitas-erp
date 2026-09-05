<?php

namespace App\Http\Controllers\Api;

use App\Models\CycleCountLine;
use Illuminate\Database\Eloquent\Model;

/**
 * Derived fields the API returns but the database does not store.
 *
 * These are values that are cheap to compute and would otherwise go stale if
 * denormalised — an attainment percentage, an ageing status, a variance. Each
 * receives the loaded model and returns the value for one JSON field.
 */
class Computed
{
    /* ------------------------------- Sales -------------------------------- */

    public static function campaignRoi(Model $row): float
    {
        $spend = (float) $row->spend;

        return $spend > 0 ? round(((float) $row->attributed_revenue - $spend) / $spend, 2) : 0.0;
    }

    public static function attainment(Model $row): float
    {
        $quota = (float) $row->quota;

        return $quota > 0 ? round(((float) $row->actual / $quota) * 100, 1) : 0.0;
    }

    public static function attainmentStatus(Model $row): string
    {
        $attainment = self::attainment($row);

        return match (true) {
            $attainment >= 100 => 'Achieved',
            $attainment >= 85 => 'On Track',
            $attainment >= 65 => 'At Risk',
            default => 'Behind',
        };
    }

    /* ----------------------------- Warehouse ------------------------------ */

    public static function stockValue(Model $row): float
    {
        return round((float) $row->on_hand * (float) $row->unit_cost, 2);
    }

    /**
     * When this line was last physically counted, from the posted count
     * history — not a column, because a count posts against the item and
     * warehouse, not this specific balance row, and the two must never be
     * able to disagree.
     */
    public static function lastCountedAt(Model $row): ?string
    {
        return CycleCountLine::query()
            ->join('cycle_counts', 'cycle_counts.id', '=', 'cycle_count_lines.cycle_count_id')
            ->where('cycle_count_lines.item_id', $row->item_id)
            ->where('cycle_counts.warehouse_id', $row->warehouse_id)
            ->where('cycle_counts.status', 'Posted')
            ->max('cycle_counts.count_date');
    }

    /**
     * Stock health. Expiry outranks quantity: a full bin that expires next
     * month is a write-off waiting to happen, not healthy stock.
     */
    public static function stockStatus(Model $row): string
    {
        $onHand = (float) $row->on_hand;
        if ($onHand <= 0) {
            return 'Out of Stock';
        }

        if ($row->expiry_date) {
            $daysToExpiry = now()->startOfDay()->diffInDays($row->expiry_date, false);
            if ($daysToExpiry < 60) {
                return 'Expiring Soon';
            }
        }

        $reorderPoint = (float) ($row->item->reorder_point ?? 0);
        $available = (float) $row->available;

        return match (true) {
            $available <= $reorderPoint => 'Low Stock',
            $reorderPoint > 0 && $onHand > $reorderPoint * 4 => 'Overstock',
            default => 'In Stock',
        };
    }

    /* ---------------------------- Maintenance ----------------------------- */

    /** Labour plus parts, so no screen has to add two columns and disagree. */
    public static function workOrderCost(Model $row): float
    {
        return round((float) $row->labor_cost + (float) $row->parts_cost, 2);
    }

    /**
     * Whether a fuel issuance is worth asking about.
     *
     * The stored column is a boolean, which is right for the database and wrong
     * on a screen — a column reading "true" tells a fleet supervisor nothing.
     */
    public static function fuelReview(Model $row): string
    {
        return $row->is_flagged ? 'Check' : 'Normal';
    }

    /**
     * Seats still to fill on a manpower request.
     *
     * The figure recruiters actually work to — headcount is what was approved,
     * filled is history, and the gap between them is the job.
     */
    public static function requisitionOpenings(Model $row): int
    {
        return max(0, (int) $row->headcount - (int) $row->filled);
    }

    /**
     * What a deduction arrangement has actually collected, and what is left.
     *
     * Both are summed from the payslip lines rather than read from a stored
     * balance, so a recomputed payroll run gives its collections back instead
     * of leaving a loan looking more paid off than it is.
     */
    public static function deductionCollected(Model $row): float
    {
        return round((float) ($row->lines_sum_amount ?? 0), 2);
    }

    /** Null on an open-ended arrangement, which has no principal to run out. */
    public static function deductionOutstanding(Model $row): ?float
    {
        if ($row->principal === null) {
            return null;
        }

        return round(max(0, (float) $row->principal - (float) ($row->lines_sum_amount ?? 0)), 2);
    }

    /** How many further cut-offs at the current instalment, if nothing changes. */
    public static function deductionCutoffsLeft(Model $row): ?int
    {
        $outstanding = self::deductionOutstanding($row);
        $instalment = (float) $row->amount_per_cutoff;

        if ($outstanding === null || $instalment <= 0) {
            return null;
        }

        return (int) ceil($outstanding / $instalment);
    }

    /**
     * The itemised deduction lines on a payslip.
     *
     * Statutory contributions and tax have their own columns and are not
     * repeated here — a consumer that summed both would count them twice.
     * These are the loans, advances and the rest.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function payslipDeductionLines(Model $row): array
    {
        return $row->lines
            ->where('kind', 'deduction')
            ->map(fn ($line) => [
                'id' => $line->id,
                'code' => $line->code,
                'label' => $line->label,
                'amount' => (float) $line->amount,
                'deductionId' => $line->employee_deduction_id,
            ])
            ->values()
            ->all();
    }

    /**
     * The itemised earnings on a payslip.
     *
     * The mirror of the deduction lines above, and it exists for the same
     * reason: a payslip that shows an unexplained figure in gross pay is a
     * payslip somebody queries. A rice subsidy should say "rice subsidy".
     *
     * `locked` is always false here — an earning line is never a collection
     * against a loan balance, so there is nothing derived from it that
     * deleting it would silently unwind.
     *
     * @return list<array<string, mixed>>
     */
    public static function payslipEarningLines(Model $row): array
    {
        return $row->lines
            ->where('kind', 'earning')
            ->map(fn ($line) => [
                'id' => $line->id,
                'code' => $line->code,
                'label' => $line->label,
                'amount' => (float) $line->amount,
                'taxable' => (bool) $line->taxable,
                'locked' => false,
            ])
            ->values()
            ->all();
    }

    /** What a spare part on the shelf is worth, at what it cost. */
    public static function sparePartValue(Model $row): float
    {
        return round((float) ($row->stock_balances_sum_on_hand ?? 0) * (float) $row->unit_cost, 2);
    }

    /**
     * Whether a repair could be blocked waiting on this part.
     *
     * A spare with no reorder point set has no threshold to be below, so it
     * reports stock rather than a health it cannot judge.
     */
    public static function sparePartStatus(Model $row): string
    {
        $available = (float) ($row->stock_balances_sum_available ?? 0);
        $reorderPoint = (float) $row->reorder_point;

        return match (true) {
            $available <= 0 => 'Out of Stock',
            $reorderPoint > 0 && $available <= $reorderPoint => 'Low Stock',
            default => 'In Stock',
        };
    }

    /* ------------------------------ Finance ------------------------------- */

    /**
     * How far a draft journal is from balancing.
     *
     * Shown on the list so the reason an entry cannot be posted is visible
     * before anyone opens it and tries.
     */
    public static function journalOutOfBalance(Model $row): float
    {
        return round((float) $row->total_debit - (float) $row->total_credit, 2);
    }

    /** A statement line's reconciliation state, as a word rather than a flag. */
    public static function reconciliationStatus(Model $row): string
    {
        return $row->is_reconciled ? 'Reconciled' : 'Unreconciled';
    }

    public static function budgetAccount(Model $row): string
    {
        return $row->account ? "{$row->account->code} · {$row->account->name}" : '—';
    }

    public static function budgetVariance(Model $row): float
    {
        return round((float) $row->ytd_budget - (float) $row->ytd_actual, 2);
    }

    public static function budgetVariancePct(Model $row): float
    {
        $budget = (float) $row->ytd_budget;

        return $budget > 0 ? round((self::budgetVariance($row) / $budget) * 100, 1) : 0.0;
    }

    public static function budgetStatus(Model $row): string
    {
        $variancePct = self::budgetVariancePct($row);

        return match (true) {
            $variancePct < -5 => 'Over Budget',
            $variancePct > 8 => 'Under Budget',
            default => 'On Budget',
        };
    }

    /* --------------------------------- HR --------------------------------- */

    /** The shift's window as one readable string, e.g. "08:00 — 17:00". */
    public static function shiftWindow(Model $row): string
    {
        return substr((string) $row->starts_at, 0, 5).' — '.substr((string) $row->ends_at, 0, 5);
    }

    /** Reference rows show a status word rather than an is-active flag. */
    public static function activeStatus(Model $row): string
    {
        return $row->is_active ? 'Active' : 'Inactive';
    }

    /**
     * Whether the monitor raised this case or a person did.
     *
     * Worth showing: an automatic notice points at an attendance record anyone
     * can check, which is a different thing from somebody's report.
     */
    public static function caseOrigin(Model $row): string
    {
        return $row->is_automatic ? 'Attendance scan' : 'Reported';
    }

    /** Whether the employee has confirmed receipt of the notice. */
    public static function caseAcknowledged(Model $row): string
    {
        return $row->acknowledged_at ? 'Acknowledged' : 'Not acknowledged';
    }

    /* ------------------------------- Admin -------------------------------- */

    /**
     * The money band a rule applies to, as one readable phrase.
     *
     * "Over ₱50,000" reads better on a list than two numeric columns that a
     * reader has to combine in their head.
     */
    public static function approvalCondition(Model $row): string
    {
        $min = (float) $row->min_amount;
        $max = $row->max_amount === null ? null : (float) $row->max_amount;

        return match (true) {
            $min <= 0 && $max === null => 'Any amount',
            $max === null => 'Over '.number_format($min, 0),
            $min <= 0 => 'Up to '.number_format($max, 0),
            default => number_format($min, 0).' — '.number_format($max, 0),
        };
    }

    /** Who signs at this step: a role, a named person, or nobody yet. */
    public static function approvalApprover(Model $row): string
    {
        return $row->approverUser->name
            ?? $row->approverRole->name
            ?? 'Unassigned';
    }

    public static function primaryRole(Model $row): string
    {
        if ($row->is_super_admin) {
            return 'System Administrator';
        }

        return $row->roles->first()->name ?? 'No role assigned';
    }
}
