<?php

namespace App\Services;

use App\Models\BranchUnit;
use App\Models\Employee;
use App\Models\WageOrder;
use App\Models\WageOrderAdjustment;
use Illuminate\Support\Facades\DB;

/**
 * A DOLE wage order, entered once, propagated to every employee it affects.
 *
 * The rate itself is not something this system can know on its own — that is
 * a person reading a DOLE issuance and typing a number in, same as any real
 * payroll office. What was missing was everything after that: matching it to
 * the right employees and raising their pay to the floor, which used to mean
 * opening the masterfile and editing salaries one at a time, hoping nobody
 * was missed.
 *
 * The conversion between a daily rate and what `employees.salary` actually
 * stores mirrors `PayrollEngine::payslipFor()` exactly — the same
 * `per_hour` split, the same `working_days_factor` setting — because a wage
 * check that used a different formula from the payroll run itself would tell
 * an employee they are being paid the minimum when the payslip disagrees.
 */
class WageOrderOperations
{
    public function __construct(
        private readonly Settings $settings,
        private readonly NotificationDispatcher $notifications,
    ) {}

    /** @param  array<string, mixed>  $data  @param  list<int>  $branchIds */
    public function create(array $data, array $branchIds, ?int $createdBy): WageOrder
    {
        return DB::transaction(function () use ($data, $branchIds, $createdBy) {
            $order = WageOrder::create($data + ['created_by' => $createdBy]);
            $order->branches()->sync($branchIds);

            return $order->fresh(['branches']);
        });
    }

    /** Daily-rate equivalent of whatever `employees.salary` currently holds. */
    public function dailyRateOf(Employee $employee): float
    {
        $hoursPerDay = (int) $this->settings->get('payroll', 'hours_per_day', 8);
        $factor = (int) $this->settings->get('payroll', 'working_days_factor', 313);

        if ($employee->per_hour) {
            return round((float) $employee->salary * $hoursPerDay, 2);
        }

        return $factor > 0 ? round((float) $employee->salary * 12 / $factor, 2) : 0.0;
    }

    /**
     * Raises every affected minimum-wage earner already below the order's
     * rate up to it, and only them — somebody already paid above the floor
     * is not touched, and this never lowers anybody's pay.
     *
     * @return array{adjusted: int, alreadyCompliant: int, employees: list<array<string, mixed>>}
     */
    public function apply(WageOrder $order, ?int $appliedBy): array
    {
        if ($order->applied_at) {
            throw new \RuntimeException('This wage order has already been applied.');
        }

        $branchIds = $order->branches()->pluck('branch_units.id');

        $employees = Employee::query()
            ->whereIn('branch_unit_id', $branchIds)
            ->where('minimum_wage_earner', true)
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->get();

        $hoursPerDay = (int) $this->settings->get('payroll', 'hours_per_day', 8);
        $factor = (int) $this->settings->get('payroll', 'working_days_factor', 313);
        $rate = (float) $order->daily_rate;

        $rows = [];
        $adjusted = 0;
        $compliant = 0;

        DB::transaction(function () use ($employees, $order, $rate, $hoursPerDay, $factor, $appliedBy, &$rows, &$adjusted, &$compliant) {
            foreach ($employees as $employee) {
                $oldDaily = $this->dailyRateOf($employee);

                if ($oldDaily >= $rate) {
                    $compliant++;

                    continue;
                }

                $oldSalary = (float) $employee->salary;
                // The inverse of dailyRateOf(): the salary figure that
                // produces exactly the order's rate under the same formula,
                // so the payslip and this check never disagree afterwards.
                $newSalary = $employee->per_hour
                    ? ($hoursPerDay > 0 ? round($rate / $hoursPerDay, 4) : $oldSalary)
                    : ($factor > 0 ? round($rate * $factor / 12, 4) : $oldSalary);

                $employee->update(['salary' => $newSalary]);

                WageOrderAdjustment::create([
                    'wage_order_id' => $order->id,
                    'employee_id' => $employee->id,
                    'old_salary' => $oldSalary,
                    'new_salary' => $newSalary,
                    'old_daily_rate' => $oldDaily,
                    'new_daily_rate' => $rate,
                ]);

                $rows[] = [
                    'employee' => $employee->full_name,
                    'employeeNo' => $employee->employee_no,
                    'oldDailyRate' => $oldDaily,
                    'newDailyRate' => $rate,
                ];
                $adjusted++;
            }

            $order->update(['applied_at' => now(), 'applied_by' => $appliedBy]);
        });

        if ($rows !== []) {
            $this->notifications->dispatch(
                event: 'wage_order.applied',
                subject: "Wage order applied — {$adjusted} employee(s) adjusted",
                view: 'emails.wage-order-applied',
                data: ['order' => $order, 'rows' => $rows],
                referenceType: 'WageOrder',
                referenceId: $order->id,
            );
        }

        return ['adjusted' => $adjusted, 'alreadyCompliant' => $compliant, 'employees' => $rows];
    }

    /** A preview of what applying would do, without writing anything. */
    public function preview(WageOrder $order): array
    {
        $branchIds = $order->branches()->pluck('branch_units.id');

        $employees = Employee::query()
            ->whereIn('branch_unit_id', $branchIds)
            ->where('minimum_wage_earner', true)
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->get();

        $rate = (float) $order->daily_rate;
        $below = $employees->filter(fn (Employee $e) => $this->dailyRateOf($e) < $rate);

        return [
            'affected' => $employees->count(),
            'belowRate' => $below->count(),
            'employees' => $below->map(fn (Employee $e) => [
                'employee' => $e->full_name,
                'employeeNo' => $e->employee_no,
                'currentDailyRate' => $this->dailyRateOf($e),
            ])->values()->all(),
        ];
    }
}
