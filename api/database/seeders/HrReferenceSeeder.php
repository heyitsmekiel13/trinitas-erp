<?php

namespace Database\Seeders;

use App\Models\Employee;
use App\Models\LeaveBalance;
use App\Models\LeaveType;
use App\Models\Shift;
use Illuminate\Database\Seeder;

/**
 * Shifts and leave types.
 *
 * Reference data, like the chart of accounts: without a shift there is nothing
 * for a punch to be late against, and without leave types nobody can file for a
 * day off. Entitlements follow the Philippine statutory minimum — five days of
 * service incentive leave — plus the categories most SMBs actually operate.
 */
class HrReferenceSeeder extends Seeder
{
    /** name, start, end, break minutes, grace minutes, night shift */
    private const SHIFTS = [
        // The company's normal office hours. Everything else is a variant.
        ['Day 8:30 — 17:30', '08:30:00', '17:30:00', 60, 15, false],
        ['Early 6:00 — 15:00', '06:00:00', '15:00:00', 60, 15, false],
        ['Mid 12:00 — 21:00', '12:00:00', '21:00:00', 60, 15, false],
        ['Night 22:00 — 07:00', '22:00:00', '07:00:00', 60, 15, true],
    ];

    /** name, code, days a year, paid, convertible to cash */
    private const LEAVE_TYPES = [
        ['Service Incentive Leave', 'SIL', 5, true],
        ['Vacation Leave', 'VL', 10, true],
        ['Sick Leave', 'SL', 10, true],
        ['Emergency Leave', 'EL', 3, true],
        ['Maternity Leave', 'ML', 105, true],
        ['Paternity Leave', 'PL', 7, true],
        ['Solo Parent Leave', 'SPL', 7, true],
        ['Bereavement Leave', 'BL', 3, true],
        ['Leave Without Pay', 'LWOP', 0, false],
    ];

    public function run(): void
    {
        foreach (self::SHIFTS as $i => [$name, $start, $end, $break, $grace, $night]) {
            Shift::updateOrCreate(['name' => $name], [
                'starts_at' => $start,
                'ends_at' => $end,
                'break_minutes' => $break,
                // Fifteen minutes before a late arrival counts, which is the
                // usual company practice and the threshold the infraction
                // monitor measures against.
                'grace_minutes' => $grace,
                'is_night_shift' => $night,
                'is_active' => true,
            ]);
        }

        foreach (self::LEAVE_TYPES as [$name, $code, $days, $paid]) {
            LeaveType::updateOrCreate(['code' => $code], [
                'name' => $name,
                'annual_credits' => $days,
                'is_paid' => $paid,
                'is_active' => true,
            ]);
        }

        $this->assignShifts();
        $this->openLeaveBalances();
    }

    /** Everybody without a roster goes on the standard day shift. */
    private function assignShifts(): void
    {
        $day = Shift::where('name', 'Day 8:30 — 17:30')->value('id');

        if ($day) {
            Employee::whereNull('shift_id')->update(['shift_id' => $day]);
        }
    }

    /**
     * Opens this year's balance for every active employee.
     *
     * A leave type with no balance behind it cannot be filed against, so the
     * entitlement is materialised rather than inferred at filing time.
     */
    private function openLeaveBalances(): void
    {
        $year = (int) date('Y');
        $types = LeaveType::where('annual_credits', '>', 0)->get();
        $employees = Employee::where('employment_status', '!=', 'Resigned')->get(['id']);

        foreach ($employees as $employee) {
            foreach ($types as $type) {
                LeaveBalance::firstOrCreate(
                    ['employee_id' => $employee->id, 'leave_type_id' => $type->id, 'year' => $year],
                    [
                        'credits' => $type->annual_credits,
                        'used' => 0,
                        'balance' => $type->annual_credits,
                    ],
                );
            }
        }
    }
}
