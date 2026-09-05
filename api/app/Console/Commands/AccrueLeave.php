<?php

namespace App\Console\Commands;

use App\Models\Employee;
use App\Models\LeaveBalance;
use App\Models\LeaveType;
use App\Services\HrAnalytics;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Credits each active employee's monthly 1/12 share of every active leave
 * type's annual entitlement. Safe to run daily: `last_accrued_period` (a
 * 'YYYY-MM' stamp) makes crediting a no-op once a balance has already been
 * accrued for the current month, so a missed run catches up on the next
 * one and a double run changes nothing — same shape as every other
 * scheduled command in routes/console.php.
 */
class AccrueLeave extends Command
{
    protected $signature = 'hr:accrue-leave';

    protected $description = "Credit this month's share of each leave type's annual entitlement to every active employee";

    public function handle(): int
    {
        $period = now()->format('Y-m');
        $year = now()->year;

        $leaveTypes = LeaveType::where('is_active', true)
            ->where('annual_credits', '>', 0)
            ->get();

        if ($leaveTypes->isEmpty()) {
            $this->info('No active leave types with an annual credit to accrue.');

            return self::SUCCESS;
        }

        $employees = Employee::whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->whereNull('date_separated')
            ->get(['id']);

        $accrued = 0;

        DB::transaction(function () use ($employees, $leaveTypes, $period, $year, &$accrued) {
            foreach ($employees as $employee) {
                foreach ($leaveTypes as $type) {
                    $balance = LeaveBalance::firstOrCreate(
                        ['employee_id' => $employee->id, 'leave_type_id' => $type->id, 'year' => $year],
                        ['credits' => 0, 'used' => 0, 'balance' => 0],
                    );

                    if ($balance->last_accrued_period === $period) {
                        continue;
                    }

                    $monthly = round($type->annual_credits / 12, 2);
                    $add = min($monthly, max(0, $type->annual_credits - $balance->credits));

                    if ($add > 0) {
                        $balance->credits += $add;
                        $balance->balance += $add;
                        $accrued++;
                    }

                    $balance->last_accrued_period = $period;
                    $balance->save();
                }
            }
        });

        $this->info("Accrued leave for {$accrued} employee/leave-type balances ({$period}).");

        return self::SUCCESS;
    }
}
