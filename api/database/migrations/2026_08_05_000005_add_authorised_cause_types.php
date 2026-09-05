<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The other half of Philippine separation law.
 *
 * Every case type the system knew about was misconduct — tardiness, a policy
 * violation, a safety incident. Those are just causes, and they run on the
 * twin-notice rule.
 *
 * Authorised causes are separations for a business reason rather than a fault:
 * redundancy, retrenchment, closure, and disease (Labour Code arts. 298–299).
 * They follow a different process — thirty days' written notice to both the
 * employee and the DOLE regional office, plus separation pay — and none of it
 * could be recorded because the types did not exist.
 *
 * `Constructive Dismissal` is added separately: it is a complaint made against
 * the employer rather than a cause the employer invokes, and it needs a home
 * in the register so it can be investigated rather than filed as a grievance.
 */
return new class extends Migration
{
    private const JUST_CAUSES = "'Tardiness','Absence Without Leave','Policy Violation','Safety Incident','Performance','Grievance'";

    private const AUTHORISED = "'Redundancy','Retrenchment','Closure','Disease'";

    private const OTHER = "'Constructive Dismissal'";

    public function up(): void
    {
        self::mysqlOnly('ALTER TABLE employee_cases MODIFY COLUMN type ENUM('
            .self::JUST_CAUSES.','.self::AUTHORISED.','.self::OTHER
            .") NOT NULL DEFAULT 'Policy Violation'");
    }

    public function down(): void
    {
        // Anything on one of the new types would violate the narrower enum.
        DB::table('employee_cases')
            ->whereIn('type', ['Redundancy', 'Retrenchment', 'Closure', 'Disease', 'Constructive Dismissal'])
            ->update(['type' => 'Policy Violation']);

        self::mysqlOnly('ALTER TABLE employee_cases MODIFY COLUMN type ENUM('
            .self::JUST_CAUSES.") NOT NULL DEFAULT 'Policy Violation'");
    }

    /**
     * Runs a statement only on MySQL.
     *
     * The statements below are MySQL's own syntax for widening an enum in
     * place, which the schema builder cannot express. Every other driver skips
     * them: SQLite has no MODIFY COLUMN, and the test suite runs on an
     * in-memory SQLite database — without this guard the whole migration set
     * fails before the first test.
     */
    private static function mysqlOnly(string $sql): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            DB::statement($sql);
        }
    }
};
