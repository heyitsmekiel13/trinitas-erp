<?php

namespace Database\Seeders;

use App\Models\Holiday;
use Illuminate\Database\Seeder;

/**
 * Philippine public holidays.
 *
 * The holidays table existed and was empty, which meant every deadline the
 * system derived counted Christmas Day and Holy Week as ordinary working days.
 * A five-day SLA raised in the week before Christmas came out roughly two days
 * short of what it promised, and the person holding it was recorded as late
 * for a week the office was shut.
 *
 * Two caveats worth stating rather than discovering:
 *
 *   - The movable Islamic holidays (Eid'l Fitr, Eid'l Adha) follow the lunar
 *     calendar and are fixed each year by proclamation. The dates below are
 *     the proclaimed ones where published and the astronomical estimate
 *     otherwise; they should be corrected when the proclamation lands.
 *   - Proclamations also add one-off holidays each year. This seeder is a
 *     floor, not a complete record — Admin → Company & Branches is where the
 *     rest belong.
 *
 * Safe to rerun: matched on date and name, so a holiday somebody has already
 * entered by hand is updated rather than duplicated.
 */
class PhilippineHolidaySeeder extends Seeder
{
    /**
     * year => [ [date, name, type], … ]
     *
     * `type` follows the labour code distinction, because it decides pay:
     * a regular holiday is paid at 200% when worked, a special non-working day
     * at 130%. The column is an enum of exactly
     * ('Regular','Special Non-Working','Local') — the strings below must match
     * it, and abbreviating to "Special" truncates the write and loses the row.
     * Payroll does not read this table yet, but recording the distinction now
     * is cheaper than backfilling it later.
     */
    private const HOLIDAYS = [
        2026 => [
            ['2026-01-01', "New Year's Day", 'Regular'],
            ['2026-02-17', 'Chinese New Year', 'Special Non-Working'],
            ['2026-02-25', 'EDSA People Power Revolution Anniversary', 'Special Non-Working'],
            ['2026-04-02', 'Maundy Thursday', 'Regular'],
            ['2026-04-03', 'Good Friday', 'Regular'],
            ['2026-04-04', 'Black Saturday', 'Special Non-Working'],
            ['2026-04-09', 'Araw ng Kagitingan', 'Regular'],
            ['2026-05-01', 'Labor Day', 'Regular'],
            ['2026-06-12', 'Independence Day', 'Regular'],
            ['2026-08-21', 'Ninoy Aquino Day', 'Special Non-Working'],
            ['2026-08-31', 'National Heroes Day', 'Regular'],
            ['2026-11-01', "All Saints' Day", 'Special Non-Working'],
            ['2026-11-30', 'Bonifacio Day', 'Regular'],
            ['2026-12-08', 'Immaculate Conception', 'Special Non-Working'],
            ['2026-12-24', 'Christmas Eve', 'Special Non-Working'],
            ['2026-12-25', 'Christmas Day', 'Regular'],
            ['2026-12-30', 'Rizal Day', 'Regular'],
            ['2026-12-31', 'Last Day of the Year', 'Special Non-Working'],
        ],
        2027 => [
            ['2027-01-01', "New Year's Day", 'Regular'],
            ['2027-02-06', 'Chinese New Year', 'Special Non-Working'],
            ['2027-02-25', 'EDSA People Power Revolution Anniversary', 'Special Non-Working'],
            ['2027-03-25', 'Maundy Thursday', 'Regular'],
            ['2027-03-26', 'Good Friday', 'Regular'],
            ['2027-03-27', 'Black Saturday', 'Special Non-Working'],
            ['2027-04-09', 'Araw ng Kagitingan', 'Regular'],
            ['2027-05-01', 'Labor Day', 'Regular'],
            ['2027-06-12', 'Independence Day', 'Regular'],
            ['2027-08-21', 'Ninoy Aquino Day', 'Special Non-Working'],
            ['2027-08-30', 'National Heroes Day', 'Regular'],
            ['2027-11-01', "All Saints' Day", 'Special Non-Working'],
            ['2027-11-30', 'Bonifacio Day', 'Regular'],
            ['2027-12-08', 'Immaculate Conception', 'Special Non-Working'],
            ['2027-12-24', 'Christmas Eve', 'Special Non-Working'],
            ['2027-12-25', 'Christmas Day', 'Regular'],
            ['2027-12-30', 'Rizal Day', 'Regular'],
            ['2027-12-31', 'Last Day of the Year', 'Special Non-Working'],
        ],
    ];

    public function run(): void
    {
        foreach (self::HOLIDAYS as $rows) {
            foreach ($rows as [$date, $name, $type]) {
                Holiday::updateOrCreate(
                    ['holiday_date' => $date, 'name' => $name],
                    ['type' => $type, 'branch_unit_id' => null],
                );
            }
        }
    }
}
