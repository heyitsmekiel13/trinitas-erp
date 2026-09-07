<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The punch clock's overtime pair (`ot-in`/`ot-out`) was built — the
 * self-service UI, `TimeClock`, `PunchGuard` — without ever widening the
 * enum `punch_events.action` was actually restricted to. Every overtime
 * punch has been failing at the database with a truncation error since,
 * because MySQL rejects a value an enum column does not list.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE punch_events MODIFY action ENUM('in', 'break-out', 'break-in', 'out', 'ot-in', 'ot-out')");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE punch_events MODIFY action ENUM('in', 'break-out', 'break-in', 'out')");
    }
};
